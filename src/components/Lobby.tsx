import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, serverTimestamp, collection, query, where, onSnapshot, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Plus, LogIn, BookOpen, PlayCircle, Shield } from 'lucide-react';

interface LobbyProps {
  onOpenBestiary: () => void;
}

interface ActiveRoom {
  id: string;
  scenario: string;
  hostId: string;
  status: string;
}

export default function Lobby({ onOpenBestiary }: LobbyProps) {
  const [joinCode, setJoinCode] = useState('');
  const [scenario, setScenario] = useState('Вы очнулись в темной, сырой пещере. Вы не помните, как сюда попали. Вдалеке мерцает тусклый свет.');
  const [isCreating, setIsCreating] = useState(false);
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) return;
    
    const userRef = doc(db, 'users', auth.currentUser.uid);
    const unsubUser = onSnapshot(userRef, async (docSnap) => {
      if (docSnap.exists()) {
        const userData = docSnap.data();
        const roomIds = userData.activeRoomIds || [];
        
        // Also include rooms where user is host (just in case they aren't in the list)
        const hostQuery = query(collection(db, 'rooms'), where('hostId', '==', auth.currentUser.uid));
        const hostSnap = await getDoc(hostQuery as any); // Simplified for now, better to listen
        
        // For simplicity, let's just listen to the specific rooms in the list
        if (roomIds.length > 0) {
          const roomsQuery = query(collection(db, 'rooms'), where('__name__', 'in', roomIds.slice(0, 10)));
          onSnapshot(roomsQuery, (snapshot) => {
            const rooms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ActiveRoom));
            setActiveRooms(rooms);
            setLoadingRooms(false);
          });
        } else {
          setActiveRooms([]);
          setLoadingRooms(false);
        }
      }
    });

    return () => unsubUser();
  }, []);

  const handleSwitchRoom = async (roomId: string) => {
    if (!auth.currentUser) return;
    await setDoc(doc(db, 'users', auth.currentUser.uid), { currentRoomId: roomId }, { merge: true });
  };

  const handleCreateRoom = async () => {
    if (!auth.currentUser) return;
    setIsCreating(true);
    try {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const roomRef = doc(db, 'rooms', roomId);
      
      await setDoc(roomRef, {
        hostId: auth.currentUser.uid,
        scenario: scenario,
        turn: 0,
        status: 'lobby',
        quests: [],
        createdAt: serverTimestamp()
      });
      
      // Update user profile to persist session and add to active rooms
      const userRef = doc(db, 'users', auth.currentUser.uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data();
      const activeRoomIds = userData?.activeRoomIds || [];
      if (!activeRoomIds.includes(roomId)) {
        activeRoomIds.push(roomId);
      }
      
      await updateDoc(userRef, { 
        currentRoomId: roomId,
        activeRoomIds: activeRoomIds
      });
    } catch (error) {
      console.error("Error creating room", error);
      alert("Не удалось создать комнату.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (joinCode.trim() && auth.currentUser) {
      const roomId = joinCode.trim().toUpperCase();
      try {
        const roomRef = doc(db, 'rooms', roomId);
        const roomSnap = await getDoc(roomRef);
        if (!roomSnap.exists()) {
          alert("Комната с таким кодом не найдена.");
          return;
        }
        // First reset, then set to ensure a fresh state if already in a room
        const userRef = doc(db, 'users', auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data();
        const activeRoomIds = userData?.activeRoomIds || [];
        if (!activeRoomIds.includes(roomId)) {
          activeRoomIds.push(roomId);
        }
        
        await updateDoc(userRef, { 
          currentRoomId: roomId,
          activeRoomIds: activeRoomIds
        });
      } catch (error) {
        console.error("Error joining room", error);
        alert("Произошла ошибка при попытке войти в комнату.");
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center p-4 overflow-y-auto">
      <div className="w-full space-y-8 pb-8">
        
        {/* Active Sessions Section */}
        {activeRooms.length > 0 && (
          <div className="w-full space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2 font-display">
              <PlayCircle size={20} className="text-orange-500" />
              Ваши активные сессии
            </h2>
            <div className="grid gap-3">
              {activeRooms.map(room => (
                <button
                  key={room.id}
                  onClick={() => handleSwitchRoom(room.id)}
                  className="w-full bg-neutral-900 border border-neutral-800 hover:border-orange-500/50 p-4 rounded-xl text-left transition-all group"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-mono text-xs text-orange-500 bg-orange-500/10 px-2 py-0.5 rounded">
                      {room.id}
                    </span>
                    {room.hostId === auth.currentUser?.uid && (
                      <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Shield size={10} /> ГМ
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-neutral-300 line-clamp-2 italic">
                    "{room.scenario}"
                  </p>
                  <div className="mt-3 flex items-center justify-between text-[10px] text-neutral-500">
                    <span>Статус: {room.status === 'lobby' ? 'В лобби' : 'В игре'}</span>
                    <span className="text-orange-500 opacity-0 group-hover:opacity-100 transition-opacity">Вернуться →</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 font-display">
              <Plus size={20} className="text-orange-500" />
              Создать новую игру
            </h2>
            <p className="text-sm text-neutral-400 mt-1">Начните новое приключение в роли Гейм-мастера.</p>
          </div>
          
          <div className="space-y-2">
            <label className="block text-sm font-medium text-neutral-300">Начальный сценарий</label>
            <textarea
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              rows={4}
              className="w-full bg-black border border-neutral-800 rounded-lg p-3 text-neutral-100 focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 outline-none resize-none"
              placeholder="Опишите стартовую ситуацию..."
            />
          </div>
          
          <button
            onClick={handleCreateRoom}
            disabled={isCreating || !scenario.trim()}
            className="w-full bg-orange-600 hover:bg-orange-500 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating ? 'Создание...' : 'Создать комнату'}
          </button>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-neutral-800"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-black text-neutral-500">ИЛИ</span>
          </div>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2 font-display">
              <LogIn size={20} className="text-orange-500" />
              Присоединиться к игре
            </h2>
            <p className="text-sm text-neutral-400 mt-1">Введите код комнаты, чтобы присоединиться к друзьям.</p>
          </div>
          
          <form onSubmit={handleJoinRoom} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-neutral-300">Код комнаты</label>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="w-full bg-black border border-neutral-800 rounded-lg p-3 text-neutral-100 focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500 outline-none uppercase tracking-widest font-mono"
                placeholder="Например: A1B2C3"
                maxLength={6}
              />
            </div>
            <button
              type="submit"
              disabled={!joinCode.trim()}
              className="w-full bg-orange-600 hover:bg-orange-500 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Войти в комнату
            </button>
          </form>
        </div>

        <button
          onClick={onOpenBestiary}
          className="w-full bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 text-white font-medium py-4 px-4 rounded-xl transition-colors flex items-center justify-center gap-3"
        >
          <BookOpen size={20} className="text-orange-500" />
          Открыть Бестиарий
        </button>

      </div>
    </div>
  );
}

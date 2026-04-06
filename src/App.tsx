/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { auth, db, signInWithGoogle, logout } from './firebase';
import Lobby from '@/src/components/Lobby';
import RoomView from '@/src/components/RoomView';
import BestiaryView from '@/src/components/BestiaryView';
import { LogOut, BookOpen, Home, DoorOpen } from 'lucide-react';
import { UserProfile } from './types';

type ViewState = 'main' | 'bestiary';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [activeView, setActiveView] = useState<ViewState>('main');
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setLoading(false);
        setProfileLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as UserProfile;
        setCurrentRoomId(data.currentRoomId || null);
      } else {
        // Create initial profile
        setDoc(userRef, { currentRoomId: null });
      }
      setLoading(false);
      setProfileLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleMinimizeRoom = async () => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { currentRoomId: null }, { merge: true });
    setCurrentRoomId(null);
    setActiveView('main');
  };

  const handleLeaveRoom = async () => {
    if (!user) return;
    if (currentRoomId) {
      if (!window.confirm("Вы уверены, что хотите полностью покинуть эту игру? Ваш персонаж останется в истории, но вы больше не будете активным участником.")) return;
      try {
        await deleteDoc(doc(db, 'rooms', currentRoomId, 'players', user.uid));
      } catch (e) {
        console.error("Failed to delete player from room:", e);
      }
    }
    
    // Remove from activeRoomIds
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);
    const userData = userSnap.data();
    const activeRoomIds = (userData?.activeRoomIds || []).filter((id: string) => id !== currentRoomId);
    
    await setDoc(userRef, { currentRoomId: null, activeRoomIds }, { merge: true });
    setCurrentRoomId(null);
    setActiveView('main');
  };

  if (loading || profileLoading) {
    return (
      <div className="min-h-[100dvh] bg-black flex items-center justify-center text-neutral-400">
        Загрузка...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-[100dvh] bg-black flex flex-col items-center justify-center p-4 text-neutral-100">
        <div className="max-w-md w-full space-y-8 text-center">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2 font-display">NeuroRPG</h1>
            <p className="text-orange-500">Мобильный ИИ Гейм-мастер</p>
          </div>
          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md text-black bg-orange-500 hover:bg-orange-400 transition-colors"
          >
            Войти через Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] bg-black text-neutral-100 font-sans flex flex-col max-w-md mx-auto relative shadow-2xl overflow-hidden border-x border-neutral-900">
      {isOffline && (
        <div className="bg-red-500 text-white text-xs font-bold text-center py-1 z-50 shrink-0">
          Нет подключения к интернету. Игра работает в офлайн-режиме.
        </div>
      )}
      <header className="shrink-0 border-b border-neutral-900 bg-black/80 backdrop-blur-md p-4 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <h1 
            className="text-lg font-bold text-white tracking-tight cursor-pointer flex items-center gap-2 font-display" 
            onClick={() => setActiveView('main')}
          >
            NeuroRPG
          </h1>
          {currentRoomId && activeView === 'main' && (
            <button 
              onClick={() => setActiveView('bestiary')} 
              className="text-orange-500 hover:text-orange-400 flex items-center gap-1 text-xs font-medium bg-orange-500/10 px-2 py-1 rounded-md transition-colors"
            >
              <BookOpen size={14} /> Бестиарий
            </button>
          )}
          {activeView === 'bestiary' && (
            <button 
              onClick={() => setActiveView('main')} 
              className="text-neutral-400 hover:text-white flex items-center gap-1 text-xs font-medium bg-neutral-800 px-2 py-1 rounded-md transition-colors"
            >
              <Home size={14} /> В игру
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400 truncate max-w-[80px]">{user.displayName}</span>
          {currentRoomId && (
            <>
              <button
                onClick={handleMinimizeRoom}
                className="p-2 text-neutral-400 hover:text-orange-500 transition-colors rounded-full hover:bg-neutral-900"
                title="Свернуть игру"
              >
                <Home size={16} />
              </button>
              <button
                onClick={handleLeaveRoom}
                className="p-2 text-neutral-400 hover:text-red-500 transition-colors rounded-full hover:bg-neutral-900"
                title="Покинут игру навсегда"
              >
                <DoorOpen size={16} />
              </button>
            </>
          )}
          <button
            onClick={logout}
            className="p-2 text-neutral-400 hover:text-orange-500 transition-colors rounded-full hover:bg-neutral-900"
            title="Выйти из аккаунта"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        {activeView === 'bestiary' ? (
          <BestiaryView onBack={() => setActiveView('main')} />
        ) : currentRoomId ? (
          <RoomView 
            roomId={currentRoomId} 
            onLeave={handleLeaveRoom} 
            onMinimize={handleMinimizeRoom}
            onOpenBestiary={() => setActiveView('bestiary')} 
          />
        ) : (
          <Lobby onOpenBestiary={() => setActiveView('bestiary')} />
        )}
      </main>
    </div>
  );
}

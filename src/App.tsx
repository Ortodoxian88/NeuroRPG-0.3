/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db, signInWithGoogle, logout } from './firebase';
import Lobby from './components/Lobby';
import RoomView from './components/RoomView';
import BestiaryView from './components/BestiaryView';
import { LogOut, BookOpen, Home } from 'lucide-react';
import { UserProfile } from './types';

type ViewState = 'main' | 'bestiary';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [activeView, setActiveView] = useState<ViewState>('main');

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

  const handleLeaveRoom = async () => {
    if (!user) return;
    await setDoc(doc(db, 'users', user.uid), { currentRoomId: null }, { merge: true });
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
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">SyncRPG</h1>
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
    <div className="min-h-[100dvh] bg-black text-neutral-100 font-sans flex flex-col max-w-md mx-auto relative shadow-2xl overflow-hidden border-x border-neutral-900">
      <header className="border-b border-neutral-900 bg-black/80 backdrop-blur-md p-4 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <h1 
            className="text-lg font-bold text-white tracking-tight cursor-pointer flex items-center gap-2" 
            onClick={() => setActiveView('main')}
          >
            SyncRPG
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
          <button
            onClick={logout}
            className="p-2 text-neutral-400 hover:text-orange-500 transition-colors rounded-full hover:bg-neutral-900"
            title="Выйти"
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
            onOpenBestiary={() => setActiveView('bestiary')} 
          />
        ) : (
          <Lobby onOpenBestiary={() => setActiveView('bestiary')} />
        )}
      </main>
    </div>
  );
}

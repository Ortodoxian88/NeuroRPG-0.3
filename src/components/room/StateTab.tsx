import React from 'react';
import { AppSettings, Player } from '@/src/types';
import { cn } from '@/src/lib/utils';

interface StateTabProps {
  me?: Player;
  appSettings?: AppSettings;
}

const ProgressBar = ({ current, max, color, label }: { current: number, max: number, color: string, label: string }) => {
  const percentage = Math.min(100, Math.max(0, (current / max) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-neutral-400">
        <span>{label}</span>
        <span>{current} / {max}</span>
      </div>
      <div className="h-3 w-full bg-neutral-900 rounded-full overflow-hidden border border-neutral-800">
        <div 
          className={cn("h-full transition-all duration-500 ease-out", color)} 
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

export const StateTab = ({ me, appSettings }: StateTabProps) => (
  <div className={cn("p-6 space-y-6", appSettings?.theme === 'light' ? "text-neutral-900" : "text-white")}>
    <h3 className="text-lg font-bold font-display uppercase tracking-wider">Состояние</h3>
    {me ? (
      <div className="space-y-4">
        <ProgressBar current={me.hp} max={me.maxHp} color="bg-gradient-to-r from-red-600 to-red-400" label="Здоровье (HP)" />
        <ProgressBar current={me.mana} max={me.maxMana} color="bg-gradient-to-r from-blue-600 to-blue-400" label="Мана (MP)" />
      </div>
    ) : (
      <p className="text-neutral-500 italic">Данные игрока не найдены</p>
    )}
  </div>
);

import React from 'react';
import { AppSettings } from '@/src/types';

interface InventoryTabProps {
  me: any;
  isSpectator: boolean;
  appSettings?: AppSettings;
}

export const InventoryTab = ({ me }: InventoryTabProps) => (
  <div className="p-4 text-white">
    <h3 className="font-bold mb-2">Инвентарь</h3>
    {me && me.inventory ? (
      <ul>{me.inventory.map((item: string, i: number) => <li key={i}>{item}</li>)}</ul>
    ) : (
      <p>Инвентарь пуст</p>
    )}
  </div>
);

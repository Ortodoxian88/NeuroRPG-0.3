import React from 'react';
import { AppSettings } from '@/src/types';

interface ActionInputProps {
  me: any;
  isSpectator: boolean;
  isGenerating: boolean;
  actionInput: string;
  isSubmittingAction: boolean;
  showCommands: boolean;
  filteredCommands: { cmd: string; desc: string; }[];
  isRecording: boolean;
  onInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCommandSelect: (cmd: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onVoiceInput: () => void;
  appSettings?: AppSettings;
}

export const ActionInput = ({ onInputChange, actionInput, onSubmit, onVoiceInput, isGenerating, isSubmittingAction }: ActionInputProps) => {
  if (isGenerating) return null;
  return (
    <form onSubmit={onSubmit} className="flex gap-2 p-4">
      <input 
        className="flex-1 bg-gray-800 p-2 rounded text-white"
        value={actionInput}
        onChange={onInputChange}
        placeholder="Введите действие..."
      />
      <button type="button" onClick={onVoiceInput} className="bg-gray-700 p-2 rounded">🎤</button>
      <button type="submit" disabled={isSubmittingAction} className="bg-blue-600 p-2 rounded text-white">Отправить</button>
    </form>
  );
};
